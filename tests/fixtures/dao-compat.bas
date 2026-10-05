Option Explicit
Sub Main()
Dim db As DAO.Database, rs As DAO.Recordset, q As DAO.QueryDef, f As DAO.Field
Set db = OpenDatabase("/vb.sqlite")
db.Execute "CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT)"
db.Execute "INSERT INTO t VALUES(1,'Original'),(2,'Second')"
Set q = db.CreateQueryDef("ById", "PARAMETERS k Long; SELECT * FROM t WHERE id=k")
q.Parameters("k") = 1
Debug.Print q.Parameters("k") + 1
Set rs = q.OpenRecordset()
Set f = rs.Fields("name")
Debug.Print f
rs.Edit
rs!name = "Changed"
rs.Update
Debug.Print rs.Fields("name")
rs.Edit
f = "Cancelled"
rs.MoveFirst
Debug.Print f
DBEngine.Workspaces(0).BeginTrans
db.Execute "UPDATE t SET name='Rollback' WHERE id=1"
DBEngine.Workspaces(0).Rollback
rs.Requery
Debug.Print rs!name
rs.Close
db.Close
End Sub
