#include "gtk-instance.hpp"
#include <iostream>
#include <string>
#include <unistd.h>

int main(int argc,char** argv){
  try{
    vb6::LinuxApplicationInstance registration;
    std::cout<<"READY "<<getpid()<<std::endl;
    if(argc>1&&std::string(argv[1])=="--exec"){
      execl("/bin/sh","sh","-c","printf 'EXEC_READY\\n'; read command",static_cast<char*>(nullptr));return 3;
    }
    std::string command;
    while(std::getline(std::cin,command)){
      if(command=="exit")return 0;
      if(command=="get")std::cout<<(registration.previous()?"PREVIOUS":"FIRST")<<std::endl;
      if(command=="same-process"){
        vb6::LinuxApplicationInstance second;
        if(second.previous()!=registration.previous())return 4;
        std::cout<<"SAME_PROCESS_OK"<<std::endl;
      }
    }
    return 0;
  }catch(const std::exception& error){std::cerr<<error.what()<<std::endl;return 2;}
}
