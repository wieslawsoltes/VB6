Option Explicit
Sub Main()
 Dim env As rdoEnvironment, cn As rdoConnection, q As rdoQuery, rs As rdoResultset
 Set env = rdoEngine.rdoEnvironments(0)
 env.CursorDriver = rdUseClientBatch
 Set cn = env.OpenConnection("Local", Connect:="Provider=SQLite;Data Source=:memory:", Prompt:=rdDriverNoPrompt)
 cn.Execute "CREATE TABLE r(id INTEGER PRIMARY KEY, name TEXT)"
 cn.Execute "INSERT INTO r VALUES(1,'Original'),(2,'Second')"
 Set q = cn.CreateQuery("Find", "SELECT id,name FROM r WHERE id >= ?")
 q.rdoParameters(0).Type = rdTypeINTEGER
 q(0) = 1
 Set rs = q.OpenResultset(rdOpenStatic, rdConcurBatch)
 Debug.Print rs.RowCount
 Debug.Print rs!name
 rs.Edit
 rs!name = "Changed"
 rs.Update
 Debug.Print rs.Status
 rs.BatchUpdate
 Debug.Print rs.Status
 Debug.Print rs!name
 q(0) = 2
 rs.Requery
 Debug.Print rs!name
 rs.Close
 cn.Close
End Sub
