NAME=perf-record-noobaa-$(date +%s)

echo ">>> Creating working dir $NAME"
mkdir $NAME
cd $NAME

echo ">>> Reading process info"
top -c -b -n 3 -d 10 > top
ps -efl > ps

echo ">>> Reading /proc/kallsyms"
cat /proc/kallsyms > perf.kallsyms

echo ">>> perf record (60 seconds) ..."
perf record -F99 -p `pgrep -n node` -g -- sleep 60

echo ">>> perf script ..."
perf script > perf-script.traces

echo ">>> perf report ..."
perf report -n > perf-script.traces

echo ">>> tar ..."
cd ..
tar cvzf $NAME.tar.gz $NAME/

echo ">>> Done -> $NAME.tar.gz"
